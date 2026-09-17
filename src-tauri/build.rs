fn main() {
    // Tauri embeds this dependency in application binaries, but Cargo examples
    // do not receive that resource. Native window smoke tests need Common
    // Controls v6 as well (TaskDialogIndirect is absent from v5).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    // Embed the vendored skill packages in every native build, including portable binaries.
    // include_str! also makes Cargo track changes to each file.
    let root =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("skills");
    println!("cargo:rerun-if-changed=skills");
    let mut files = Vec::new();
    collect(&root, &mut files);
    files.sort();
    let mut code = String::from("const BUNDLED_FILES: &[(&str, &str)] = &[\n");
    for file in files {
        let relative = file
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        code.push_str(&format!(
            "({relative:?}, include_str!({:?})),\n",
            file.to_str().unwrap()
        ));
    }
    code.push_str("];\n");
    std::fs::write(
        std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("agent_skills.rs"),
        code,
    )
    .unwrap();
    tauri_build::build()
}

fn collect(dir: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("bundled skills directory") {
        let entry = entry.expect("read bundled skill entry");
        let path = entry.path();
        if path.is_dir() {
            collect(&path, files);
        } else {
            files.push(path);
        }
    }
}
