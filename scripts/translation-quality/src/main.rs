//! Offline harness imports the actual production modules; it never calls an API.
#![allow(dead_code)]
#[path = "../../../src-tauri/src/translate/prompt.rs"]
mod prompt;
#[path = "../../../src-tauri/src/translate/protection.rs"]
mod protection;
#[path = "../../../src-tauri/src/translate/request.rs"]
mod request;
#[path = "../../../src-tauri/src/translate/terminology.rs"]
mod terminology;

mod config {
    pub struct TranslationConfig {
        pub base_url: String,
        pub api_key: String,
        pub model: String,
        pub glossary: Vec<(String, String)>,
        pub free_translation: bool,
    }
}
mod http {
    pub const MAX_INPUT_CHARS: usize = 50_000;
}

#[derive(serde::Deserialize)]
struct Case {
    id: String,
    category: String,
    source: String,
    target_language: String,
    glossary: Vec<(String, String)>,
    expected_terms: Vec<String>,
    protected: Vec<String>,
    reference: String,
    notes: String,
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../eval/translation-quality/cases.json");
    let cases: Vec<Case> = serde_json::from_slice(&std::fs::read(path)?)?;
    let mut ids = std::collections::HashSet::new();
    let mut categories = std::collections::BTreeMap::new();
    let mut failures = Vec::new();
    for case in &cases {
        if !ids.insert(&case.id) {
            failures.push(format!("{}: duplicate ID", case.id));
        }
        *categories.entry(&case.category).or_insert(0usize) += 1;
        if case.notes.trim().is_empty() || case.target_language.trim().is_empty() {
            failures.push(format!("{}: missing review criteria/language", case.id));
        }
        let mut actual: Vec<_> = terminology::matching_terms(&case.source, &case.glossary)
            .iter()
            .map(|(source, _)| source.clone())
            .collect();
        let mut expected = case.expected_terms.clone();
        actual.sort();
        expected.sort();
        if actual != expected {
            failures.push(format!(
                "{}: glossary {:?} != {:?}",
                case.id, actual, expected
            ));
        }
        let actual_spans: Vec<_> = protection::protected_spans(&case.source)
            .iter()
            .map(|s| case.source[s.start..s.end].to_string())
            .collect();
        if actual_spans != case.protected {
            failures.push(format!(
                "{}: spans {:?} != {:?}",
                case.id, actual_spans, case.protected
            ));
        }
        if protection::validate_protected(&case.source, &case.reference).is_err() {
            failures.push(format!("{}: reference damaged protected text", case.id));
        }
        for literal in &case.protected {
            let damaged = case.reference.replace(literal, "");
            if protection::validate_protected(&case.source, &damaged).is_ok() {
                failures.push(format!(
                    "{}: did not detect removed protected text",
                    case.id
                ));
            }
        }
    }
    println!(
        "Offline deterministic fixtures: {}. Categories: {:?}",
        cases.len(),
        categories
    );
    if !failures.is_empty() {
        return Err(failures.join("\n").into());
    }
    println!("PASS: glossary selection, protected span extraction, reference integrity, deletion mutations.");
    println!("NOT MEASURED: model translation accuracy, latency, tokens or cost. References require human review.");
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
#[path = "../../../src-tauri/src/translate/quality_tests.rs"]
mod quality_tests;
