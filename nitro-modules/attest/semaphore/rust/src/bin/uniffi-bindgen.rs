// Tiny shim so `cargo run --bin uniffi-bindgen -- generate ...` works.
// Used by build-android.sh / build-ios.sh to regenerate the Kotlin / Swift
// glue from this crate's library output. Mirrors the canonical setup
// described at https://mozilla.github.io/uniffi-rs/0.28/tutorial/foreign_language_bindings.html
fn main() {
    uniffi::uniffi_bindgen_main()
}
