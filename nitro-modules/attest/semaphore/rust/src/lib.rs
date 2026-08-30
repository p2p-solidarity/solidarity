//! solidarity-semaphore-bindings — uniffi shim around upstream `semaphore`
//! (https://github.com/semaphore-protocol/semaphore-rs).
//!
//! Exposes the FFI surface declared in `semaphore.udl` (Identity, Group,
//! generate/verify_semaphore_proof) so the iOS Swift wrapper
//! (`mopro/ios/mopro.swift`) AND the Android Kotlin reflection bridge
//! (`android/.../NativeBridge.kt`) can call the same set of functions.
//!
//! Upstream re-export note: the upstream crate was renamed from
//! `semaphore-rs` → `semaphore-protocol` (lib name `semaphore`) in
//! Apr 2026; we pin to a known main SHA in Cargo.toml. The legacy SwiftUI
//! app ships a pre-built `libsemaphore_bindings.a` xcframework that was
//! produced from the *same UDL* — so we MUST keep the UDL stable
//! (changing it would invalidate `mopro.swift`'s checksum table).
//!
//! Field-element encoding:
//!   • commitments / roots / nullifiers are returned as DECIMAL-STRING
//!     field elements (matches `SemaphoreShim.swift::decimalString(fromLittleEndian32:)`).
//!   • `Identity::to_element` / `Group::root` return 32-byte LITTLE-ENDIAN
//!     buffers (the caller flips to decimal via the host helpers).
//!   • `Group::new(members: Vec<Vec<u8>>)` takes 32-byte little-endian
//!     buffers — matches `SemaphoreShim.swift::decimalStringToLittleEndian32`.
//!
//! Mutation safety:
//!   uniffi exposes our `Identity` + `Group` as shared, so methods take
//!   `&self`. Upstream `Group` is `&mut`, so we wrap its tree in a
//!   `Mutex<Group>` and clone-out a fresh `Group` whenever we need to
//!   feed it to `Proof::generate_proof` (which takes ownership).

use std::sync::Arc;
use std::sync::Mutex;

use num_bigint::BigUint;
use semaphore::group::{Element, Group as UpstreamGroup, EMPTY_ELEMENT, ELEMENT_SIZE};
use semaphore::identity::Identity as UpstreamIdentity;
use semaphore::proof::{GroupOrMerkleProof, Proof as UpstreamProof, SemaphoreProof};

uniffi::include_scaffolding!("semaphore");

// ─── Error types (mirror semaphore.udl) ────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum GroupError {
    #[error("empty leaf")]
    EmptyLeaf,
    #[error("invalid member length")]
    InvalidMemberLength,
    #[error("member already removed")]
    RemovedMember,
    #[error("member already removed")]
    AlreadyRemovedMember,
}

#[derive(Debug, thiserror::Error)]
pub enum ProofError {
    #[error("merkle proof generation failed: {0}")]
    MerkleProofGeneration(String),
    #[error("witness generation failed: {0}")]
    WitnessGeneration(String),
    #[error("proof generation failed: {0}")]
    ProofGeneration(String),
    #[error("proof verification failed: {0}")]
    ProofVerification(String),
    #[error("invalid scope: {0}")]
    InvalidScope(String),
    #[error("invalid message: {0}")]
    InvalidMessage(String),
}

// ─── Identity ──────────────────────────────────────────────────────────────

pub struct Identity {
    inner: UpstreamIdentity,
}

impl Identity {
    pub fn new(private_key: Vec<u8>) -> Self {
        Self {
            inner: UpstreamIdentity::new(&private_key),
        }
    }

    /// Decimal-string field element so it round-trips through the
    /// SemaphoreShim.swift `decimalString(fromLittleEndian32:)` helper.
    pub fn commitment(&self) -> String {
        fq_to_decimal_string(self.inner.commitment())
    }

    pub fn private_key(&self) -> Vec<u8> {
        self.inner.private_key().to_vec()
    }

    pub fn secret_scalar(&self) -> String {
        // `secret_scalar()` returns `&Fr`. The legacy Swift surface treats
        // it as a decimal-string field element.
        use ark_ff::{BigInteger, PrimeField};
        let fr = self.inner.secret_scalar();
        let bytes = fr.into_bigint().to_bytes_le();
        BigUint::from_bytes_le(&bytes).to_string()
    }

    /// 32-byte little-endian representation of `commitment` so the host
    /// can use it as a `Group::new` element without re-encoding.
    pub fn to_element(&self) -> Vec<u8> {
        fq_to_le_element(self.inner.commitment()).to_vec()
    }
}

// ─── Group ─────────────────────────────────────────────────────────────────

pub struct Group {
    inner: Mutex<UpstreamGroup>,
}

impl Group {
    pub fn new(members: Vec<Vec<u8>>) -> Self {
        // Upstream expects [u8; 32] entries; convert and skip zero-leaves
        // (upstream Group::new rejects zero leaves explicitly).
        let elements: Vec<Element> = members
            .into_iter()
            .filter_map(|bytes| vec_to_element(&bytes))
            .filter(|e| *e != EMPTY_ELEMENT)
            .collect();

        let tree = if elements.is_empty() {
            UpstreamGroup::default()
        } else {
            UpstreamGroup::new(&elements).unwrap_or_default()
        };

        Self {
            inner: Mutex::new(tree),
        }
    }

    pub fn add_member(&self, member: Vec<u8>) -> Result<(), GroupError> {
        let element = vec_to_element(&member).ok_or(GroupError::InvalidMemberLength)?;
        if element == EMPTY_ELEMENT {
            return Err(GroupError::EmptyLeaf);
        }
        let mut tree = self.inner.lock().unwrap();
        tree.add_member(element).map_err(map_semaphore_error)
    }

    pub fn add_members(&self, members: Vec<Vec<u8>>) -> Result<(), GroupError> {
        let mut elements = Vec::with_capacity(members.len());
        for m in members {
            let element = vec_to_element(&m).ok_or(GroupError::InvalidMemberLength)?;
            if element == EMPTY_ELEMENT {
                return Err(GroupError::EmptyLeaf);
            }
            elements.push(element);
        }
        let mut tree = self.inner.lock().unwrap();
        tree.add_members(&elements).map_err(map_semaphore_error)
    }

    pub fn depth(&self) -> u32 {
        self.inner.lock().unwrap().depth() as u32
    }

    pub fn index_of(&self, member: Vec<u8>) -> Option<u32> {
        let element = vec_to_element(&member)?;
        self.inner.lock().unwrap().index_of(element).map(|i| i as u32)
    }

    pub fn members(&self) -> Vec<Vec<u8>> {
        self.inner
            .lock()
            .unwrap()
            .members()
            .into_iter()
            .map(|el| el.to_vec())
            .collect()
    }

    pub fn remove_member(&self, index: u32) -> Result<(), GroupError> {
        let mut tree = self.inner.lock().unwrap();
        tree.remove_member(index as usize).map_err(map_semaphore_error)
    }

    /// Returns the Merkle root as a 32-byte LITTLE-ENDIAN buffer (the
    /// Swift / Kotlin helpers flip it to a decimal-string field element).
    pub fn root(&self) -> Option<Vec<u8>> {
        self.inner.lock().unwrap().root().map(|el| el.to_vec())
    }

    pub fn update_member(&self, index: u32, member: Vec<u8>) -> Result<(), GroupError> {
        let element = vec_to_element(&member).ok_or(GroupError::InvalidMemberLength)?;
        if element == EMPTY_ELEMENT {
            return Err(GroupError::EmptyLeaf);
        }
        let mut tree = self.inner.lock().unwrap();
        tree.update_member(index as usize, element)
            .map_err(map_semaphore_error)
    }

    /// Internal helper — clones the underlying upstream Group so we can
    /// move it into `Proof::generate_proof` (which takes ownership).
    fn snapshot(&self) -> UpstreamGroup {
        self.inner.lock().unwrap().clone()
    }
}

// ─── Top-level proof functions ────────────────────────────────────────────

/// Generate a Semaphore proof — returns the JSON-encoded proof so the host
/// can reflate it via the existing `parseProof` helper.
pub fn generate_semaphore_proof(
    identity: Arc<Identity>,
    group: Arc<Group>,
    message: String,
    scope: String,
    merkle_tree_depth: u16,
) -> Result<String, ProofError> {
    let identity_clone = UpstreamIdentity::new(identity.inner.private_key());
    let group_snapshot = group.snapshot();

    let proof = UpstreamProof::generate_proof(
        identity_clone,
        GroupOrMerkleProof::Group(group_snapshot),
        message,
        scope,
        merkle_tree_depth,
    )
    .map_err(|e| ProofError::ProofGeneration(e.to_string()))?;

    semaphore_proof_to_json(&proof).map_err(ProofError::ProofGeneration)
}

/// Verify a previously-generated proof. The input is the JSON we emitted
/// from `generate_semaphore_proof` (or any compatible producer).
pub fn verify_semaphore_proof(proof: String) -> Result<bool, ProofError> {
    let parsed = parse_semaphore_proof(&proof).map_err(ProofError::ProofVerification)?;
    Ok(UpstreamProof::verify_proof(parsed))
}

pub fn mopro_uniffi_hello_world() -> String {
    "Hello from semaphore_bindings".to_string()
}

// ─── Encoding helpers ─────────────────────────────────────────────────────

fn vec_to_element(bytes: &[u8]) -> Option<Element> {
    if bytes.len() == ELEMENT_SIZE {
        let mut element = EMPTY_ELEMENT;
        element.copy_from_slice(bytes);
        Some(element)
    } else if bytes.len() < ELEMENT_SIZE {
        // Pad with zeros up to ELEMENT_SIZE (mirrors `bytes_to_element` upstream).
        let mut element = EMPTY_ELEMENT;
        element[..bytes.len()].copy_from_slice(bytes);
        Some(element)
    } else {
        None
    }
}

fn fq_to_le_element(fq: &ark_ed_on_bn254::Fq) -> Element {
    use ark_ff::{BigInteger, PrimeField};
    let bytes = fq.into_bigint().to_bytes_le();
    let mut element = EMPTY_ELEMENT;
    let len = bytes.len().min(ELEMENT_SIZE);
    element[..len].copy_from_slice(&bytes[..len]);
    element
}

fn fq_to_decimal_string(fq: &ark_ed_on_bn254::Fq) -> String {
    use ark_ff::{BigInteger, PrimeField};
    let bytes = fq.into_bigint().to_bytes_le();
    BigUint::from_bytes_le(&bytes).to_string()
}

fn map_semaphore_error(err: semaphore::error::SemaphoreError) -> GroupError {
    use semaphore::error::SemaphoreError as E;
    match err {
        E::EmptyLeaf => GroupError::EmptyLeaf,
        E::AlreadyRemovedMember => GroupError::AlreadyRemovedMember,
        E::RemovedMember => GroupError::RemovedMember,
        E::InputSizeExceeded(_) => GroupError::InvalidMemberLength,
        _ => GroupError::InvalidMemberLength,
    }
}

// ─── JSON (de)serialisation ────────────────────────────────────────────────
//
// Upstream gates `SemaphoreProof::{export,import}` behind the `serde`
// feature. We don't enable it (avoids pulling extra dependencies into
// the Android .so) — instead we do the same JSON shape inline so the
// keys stay `snake_case` and the parsers on iOS / Android keep matching.

fn semaphore_proof_to_json(proof: &SemaphoreProof) -> Result<String, String> {
    let mut obj = serde_json::Map::new();
    obj.insert(
        "merkle_tree_depth".to_string(),
        serde_json::Value::from(proof.merkle_tree_depth),
    );
    obj.insert(
        "merkle_tree_root".to_string(),
        serde_json::Value::from(proof.merkle_tree_root.to_string()),
    );
    obj.insert(
        "nullifier".to_string(),
        serde_json::Value::from(proof.nullifier.to_string()),
    );
    obj.insert(
        "message".to_string(),
        serde_json::Value::from(proof.message.to_string()),
    );
    obj.insert(
        "scope".to_string(),
        serde_json::Value::from(proof.scope.to_string()),
    );
    let points: Vec<serde_json::Value> = proof
        .points
        .iter()
        .map(|p| serde_json::Value::from(p.to_string()))
        .collect();
    obj.insert("points".to_string(), serde_json::Value::Array(points));
    serde_json::to_string(&obj).map_err(|e| e.to_string())
}

fn parse_semaphore_proof(json: &str) -> Result<SemaphoreProof, String> {
    use std::str::FromStr;
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let obj = value.as_object().ok_or_else(|| "not a JSON object".to_string())?;

    fn pick_str<'a>(obj: &'a serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<&'a str> {
        for k in keys {
            if let Some(v) = obj.get(*k).and_then(|v| v.as_str()) {
                return Some(v);
            }
        }
        None
    }

    fn pick_u64(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<u64> {
        for k in keys {
            if let Some(v) = obj.get(*k) {
                if let Some(n) = v.as_u64() {
                    return Some(n);
                }
                if let Some(s) = v.as_str() {
                    if let Ok(n) = s.parse::<u64>() {
                        return Some(n);
                    }
                }
            }
        }
        None
    }

    let merkle_tree_depth = pick_u64(obj, &["merkle_tree_depth", "merkleTreeDepth"])
        .ok_or_else(|| "missing merkle_tree_depth".to_string())? as u16;
    let merkle_tree_root = BigUint::from_str(
        pick_str(obj, &["merkle_tree_root", "merkleTreeRoot"])
            .ok_or_else(|| "missing merkle_tree_root".to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let nullifier = BigUint::from_str(
        pick_str(obj, &["nullifier", "nullifierHash"])
            .ok_or_else(|| "missing nullifier".to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let message = BigUint::from_str(
        pick_str(obj, &["message", "signal"]).ok_or_else(|| "missing message".to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let scope = BigUint::from_str(
        pick_str(obj, &["scope"]).ok_or_else(|| "missing scope".to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let points_array = obj
        .get("points")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "missing points array".to_string())?;
    if points_array.len() != 8 {
        return Err(format!(
            "expected 8 proof points, got {}",
            points_array.len()
        ));
    }
    let mut points: [BigUint; 8] = Default::default();
    for (i, p) in points_array.iter().enumerate() {
        let s = p
            .as_str()
            .ok_or_else(|| format!("point[{}] not a string", i))?;
        points[i] = BigUint::from_str(s).map_err(|e| e.to_string())?;
    }

    Ok(SemaphoreProof {
        merkle_tree_depth,
        merkle_tree_root,
        message,
        nullifier,
        scope,
        points,
    })
}
