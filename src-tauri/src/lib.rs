use pyo3::prelude::*;

// The usual Tauri command for testing
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Generates the Tauri context for PyTauri to use
pub fn tauri_generate_context() -> tauri::Context {
    tauri::generate_context!()
}

// This exposes your Tauri builder and context to Python as a module.
#[pymodule(gil_used = false)]
#[pyo3(name = "ext_mod")]
pub mod ext_mod {
    use super::*;

    #[pymodule_init]
    fn init(module: &Bound<'_, PyModule>) -> PyResult<()> {
        pytauri::pymodule_export(
            module,
            // Maps to Python’s `context_factory`
            |_args, _kwargs| Ok(tauri_generate_context()),
            // Maps to Python’s `builder_factory`
            |_args, _kwargs| {
                let builder = tauri::Builder::default()
                    .plugin(tauri_plugin_opener::init())
                    .invoke_handler(tauri::generate_handler![greet]);
                Ok(builder)
            },
        )
    }
}
