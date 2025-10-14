// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{convert::Infallible, env::var, error::Error, path::PathBuf};

use pyo3::wrap_pymodule;
use pytauri::standalone::{
    dunce::simplified, PythonInterpreterBuilder, PythonInterpreterEnv, PythonScript,
};
use tauri::utils::platform::resource_dir;

use agno_desktop_lib::{ext_mod, tauri_generate_context};

fn main() -> Result<Infallible, Box<dyn Error>> {
    // Figure out if we’re running in dev mode (with `tauri dev`) or standalone
    let py_env = if cfg!(dev) {
        let venv_dir = var("VIRTUAL_ENV").map_err(|err| {
            format!(
                "The app is running in tauri dev mode, \
                please activate the python virtual environment first \
                or set the `VIRTUAL_ENV` environment variable: {err}",
            )
        })?;
        PythonInterpreterEnv::Venv(PathBuf::from(venv_dir).into())
    } else {
        let context = tauri_generate_context();
        let resource_dir = resource_dir(context.package_info(), &tauri::Env::default())
            .map_err(|err| format!("failed to get resource dir: {err}"))?;
        let resource_dir = simplified(&resource_dir).to_owned();
        PythonInterpreterEnv::Standalone(resource_dir.into())
    };

    // Run the Python module (same as `python -m tauri_app`)
    let py_script = PythonScript::Module("tauri_app".into());

    // Register the Rust extension module for Python
    let builder = PythonInterpreterBuilder::new(py_env, py_script, |py| wrap_pymodule!(ext_mod)(py));
    let interpreter = builder.build()?;

    let exit_code = interpreter.run();
    std::process::exit(exit_code);
}
