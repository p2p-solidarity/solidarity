//! solidarity-semaphore-bindings — uniffi shim around `semaphore_rs`.
//!
//! Re-exports the upstream semaphore-rs types under the uniffi FFI surface
//! that `mopro.swift` (and the parallel Kotlin wrapper) expect. The exposed
//! symbols MUST line up byte-for-byte with the legacy
//! `libsemaphore_bindings.a` shipped in
//! `SemaphoreSwift/Sources/MoproiOSBindings/MoproBindings.xcframework`
//! so commitments produced by the Expo client match commitments produced
//! by the SwiftUI app on the same input.
//!
//! NOTE: this crate is intentionally a thin re-export. The interesting
//! logic (Pedersen hash, identity derivation, group root) lives in
//! upstream semaphore-rs. We add a UDL so uniffi-bindgen can emit the
//! Swift / Kotlin glue code; everything else is delegated.

use std::sync::Arc;

uniffi::include_scaffolding!("semaphore");

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

/// Semaphore identity (trapdoor + nullifier). Wraps `semaphore_rs::identity::Identity`.
pub struct Identity {
    inner: semaphore_rs::identity::Identity,
}

impl Identity {
    pub fn new(private_key: Vec<u8>) -> Self {
        Self { inner: semaphore_rs::identity::Identity::from_secret(&private_key, None) }
    }

    pub fn commitment(&self) -> String {
        self.inner.commitment().to_string()
    }

    pub fn private_key(&self) -> Vec<u8> {
        // Re-export the underlying 32-byte secret so the host can persist it.
        self.inner.trapdoor.to_be_bytes().to_vec()
    }

    pub fn secret_scalar(&self) -> String {
        self.inner.secret_hash().to_string()
    }

    pub fn to_element(&self) -> Vec<u8> {
        self.inner.commitment().to_be_bytes().to_vec()
    }
}

/// Semaphore group (Merkle tree of identity commitments).
pub struct Group {
    inner: std::sync::Mutex<semaphore_rs::poseidon_tree::PoseidonTree>,
}

impl Group {
    pub fn new(members: Vec<Vec<u8>>) -> Self {
        let mut tree = semaphore_rs::poseidon_tree::PoseidonTree::new(
            32, // depth
            semaphore_rs::Field::from(0u64),
        );
        for (i, m) in members.iter().enumerate() {
            let scalar = semaphore_rs::Field::from_be_bytes_mod_order(m);
            tree.set(i, scalar);
        }
        Self { inner: std::sync::Mutex::new(tree) }
    }

    pub fn add_member(&self, member: Vec<u8>) -> Result<(), GroupError> {
        let mut t = self.inner.lock().unwrap();
        let next = t.num_leaves();
        let scalar = semaphore_rs::Field::from_be_bytes_mod_order(&member);
        t.set(next, scalar);
        Ok(())
    }

    pub fn add_members(&self, members: Vec<Vec<u8>>) -> Result<(), GroupError> {
        for m in members {
            self.add_member(m)?;
        }
        Ok(())
    }

    pub fn depth(&self) -> u32 {
        self.inner.lock().unwrap().depth() as u32
    }

    pub fn index_of(&self, member: Vec<u8>) -> Option<u32> {
        let t = self.inner.lock().unwrap();
        let needle = semaphore_rs::Field::from_be_bytes_mod_order(&member);
        for i in 0..t.num_leaves() {
            if t.get(i) == needle {
                return Some(i as u32);
            }
        }
        None
    }

    pub fn members(&self) -> Vec<Vec<u8>> {
        let t = self.inner.lock().unwrap();
        (0..t.num_leaves()).map(|i| t.get(i).to_be_bytes().to_vec()).collect()
    }

    pub fn remove_member(&self, index: u32) -> Result<(), GroupError> {
        let mut t = self.inner.lock().unwrap();
        t.set(index as usize, semaphore_rs::Field::from(0u64));
        Ok(())
    }

    pub fn root(&self) -> Option<Vec<u8>> {
        Some(self.inner.lock().unwrap().root().to_be_bytes().to_vec())
    }

    pub fn update_member(&self, index: u32, member: Vec<u8>) -> Result<(), GroupError> {
        let mut t = self.inner.lock().unwrap();
        let scalar = semaphore_rs::Field::from_be_bytes_mod_order(&member);
        t.set(index as usize, scalar);
        Ok(())
    }
}

/// Generate a Semaphore proof. Returns the JSON-encoded proof.
pub fn generate_semaphore_proof(
    identity: Arc<Identity>,
    group: Arc<Group>,
    message: String,
    scope: String,
    merkle_tree_depth: u16,
) -> Result<String, ProofError> {
    let id = &identity.inner;
    let tree = group.inner.lock().unwrap();
    let proof = semaphore_rs::protocol::generate_proof(
        id,
        &tree,
        message.as_bytes(),
        scope.as_bytes(),
        merkle_tree_depth as usize,
    )
    .map_err(|e| ProofError::ProofGeneration(e.to_string()))?;
    serde_json::to_string(&proof)
        .map_err(|e| ProofError::ProofGeneration(format!("encode: {e}")))
}

pub fn verify_semaphore_proof(proof: String) -> Result<bool, ProofError> {
    let decoded: semaphore_rs::protocol::Proof =
        serde_json::from_str(&proof).map_err(|e| ProofError::ProofVerification(e.to_string()))?;
    semaphore_rs::protocol::verify_proof(&decoded)
        .map_err(|e| ProofError::ProofVerification(e.to_string()))
}

pub fn mopro_uniffi_hello_world() -> String {
    "Hello from semaphore_bindings".to_string()
}
