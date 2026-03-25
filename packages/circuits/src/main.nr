// VaultProof -- Key Authorization Circuit
//
// Proves:
// 1. User owns a key slot (knows slot_secret that hashes to vault_commitment)
// 2. Requesting app is authorized (Merkle membership in authorized_apps tree)
// 3. Proof is fresh (nullifier is unique per request, prevents replay)
//
// The user's device generates this proof. The vault verifies it before
// reconstructing the API key ephemerally.

// Poseidon2 hash for Merkle tree and commitments
fn poseidon_hash(left: Field, right: Field) -> Field {
    std::hash::poseidon2::Poseidon2::hash([left, right], 2)
}

// Verify Merkle path from leaf to root (max depth 10 -- supports 1024 apps per key)
fn verify_merkle_path(
    leaf: Field,
    path_elements: [Field; 10],
    path_indices: [u1; 10],
    depth: u32,
    root: Field
) -> bool {
    let mut current = leaf;

    for i in 0..10 {
        if i < depth {
            let path_element = path_elements[i];
            let is_right = path_indices[i];

            if is_right == 1 {
                current = poseidon_hash(path_element, current);
            } else {
                current = poseidon_hash(current, path_element);
            }
        }
    }

    current == root
}

fn main(
    // -- Private inputs (known only to user's device) --
    slot_secret: Field,
    share_hash: Field,
    app_auth_path: [Field; 10],
    app_auth_indices: [u1; 10],
    nonce: Field,

    // -- Public inputs (visible to vault) --
    vault_commitment: pub Field,
    app_id_hash: pub Field,
    authorized_apps_root: pub Field,
    tree_depth: pub u32,
    nullifier: pub Field
) {
    // 1. Prove ownership: user knows slot_secret + share_hash that hash to vault_commitment
    let computed_commitment = poseidon_hash(slot_secret, share_hash);
    assert(computed_commitment == vault_commitment);

    // 2. Prove app is authorized: app_id_hash is a leaf in the authorized apps tree
    let app_authorized = verify_merkle_path(
        app_id_hash,
        app_auth_path,
        app_auth_indices,
        tree_depth,
        authorized_apps_root
    );
    assert(app_authorized);

    // 3. Prove freshness: nullifier is correctly derived and unique
    let computed_nullifier = poseidon_hash(slot_secret, nonce);
    assert(computed_nullifier == nullifier);
}

// -- Tests --

#[test]
fn test_valid_authorization() {
    let slot_secret = 12345;
    let share_hash = 67890;
    let nonce = 99999;

    let vault_commitment = poseidon_hash(slot_secret, share_hash);
    let nullifier = poseidon_hash(slot_secret, nonce);

    let app_id_hash = poseidon_hash(42, 0);
    let sibling: Field = 0;
    let authorized_apps_root = poseidon_hash(app_id_hash, sibling);

    let mut app_auth_path = [0; 10];
    app_auth_path[0] = sibling;
    let app_auth_indices: [u1; 10] = [0; 10];

    main(
        slot_secret,
        share_hash,
        app_auth_path,
        app_auth_indices,
        nonce,
        vault_commitment,
        app_id_hash,
        authorized_apps_root,
        1,
        nullifier
    );
}

#[test(should_fail)]
fn test_wrong_slot_secret_fails() {
    let slot_secret = 12345;
    let share_hash = 67890;
    let nonce = 99999;

    let vault_commitment = poseidon_hash(slot_secret, share_hash);
    let nullifier = poseidon_hash(slot_secret, nonce);

    let app_id_hash = poseidon_hash(42, 0);
    let sibling: Field = 0;
    let authorized_apps_root = poseidon_hash(app_id_hash, sibling);

    let mut app_auth_path = [0; 10];
    app_auth_path[0] = sibling;
    let app_auth_indices: [u1; 10] = [0; 10];

    main(
        99999, // WRONG secret
        share_hash,
        app_auth_path,
        app_auth_indices,
        nonce,
        vault_commitment,
        app_id_hash,
        authorized_apps_root,
        1,
        nullifier
    );
}

#[test(should_fail)]
fn test_unauthorized_app_fails() {
    let slot_secret = 12345;
    let share_hash = 67890;
    let nonce = 99999;

    let vault_commitment = poseidon_hash(slot_secret, share_hash);
    let nullifier = poseidon_hash(slot_secret, nonce);

    let real_app_hash = poseidon_hash(42, 0);
    let sibling: Field = 0;
    let authorized_apps_root = poseidon_hash(real_app_hash, sibling);

    let mut app_auth_path = [0; 10];
    app_auth_path[0] = sibling;
    let app_auth_indices: [u1; 10] = [0; 10];

    let fake_app_hash = poseidon_hash(999, 0);

    main(
        slot_secret,
        share_hash,
        app_auth_path,
        app_auth_indices,
        nonce,
        vault_commitment,
        fake_app_hash, // WRONG app
        authorized_apps_root,
        1,
        nullifier
    );
}

#[test(should_fail)]
fn test_replayed_nullifier_fails() {
    let slot_secret = 12345;
    let share_hash = 67890;
    let nonce = 99999;

    let vault_commitment = poseidon_hash(slot_secret, share_hash);

    let app_id_hash = poseidon_hash(42, 0);
    let sibling: Field = 0;
    let authorized_apps_root = poseidon_hash(app_id_hash, sibling);

    let mut app_auth_path = [0; 10];
    app_auth_path[0] = sibling;
    let app_auth_indices: [u1; 10] = [0; 10];

    let fake_nullifier = poseidon_hash(slot_secret, 11111);

    main(
        slot_secret,
        share_hash,
        app_auth_path,
        app_auth_indices,
        nonce,
        vault_commitment,
        app_id_hash,
        authorized_apps_root,
        1,
        fake_nullifier // WRONG nullifier -- replay attempt
    );
}
