# Translation quality evaluation: phase 1

## What this dataset is

`eval/translation-quality/cases.json` contains 100 fixed, authored regression cases: 20 each for technical prose, UI, general language, structured text, and context-sensitive ambiguity. These are not production conversations or sampled customer data. All domains, people, URLs and placeholder values are synthetic examples. Reference translations are examples of acceptable wording, not exact-match gold outputs.

No model-quality result, API cost, or model latency is reported by the dataset itself. Passing deterministic checks establishes only the tested lexical and preservation properties. It does **not** establish accurate meaning, naturalness, factual correctness, or superiority to a stronger model.

## Record contract

- `id`: stable case identifier; keep it when correcting annotations.
- `category`: `technical`, `ui`, `general`, `format`, or `ambiguous`.
- `source`: exact original input, including whitespace and punctuation.
- `target_language`: `Chinese` or `English`.
- `context`: optional semantic annotation for controlled/manual evaluation. The first-phase application does not automatically collect or inject this context.
- `glossary`: ordered `[source, target]` pairs in the existing application's format. This is a lexical matching fixture, not a context-aware terminology database.
- `expected_terms`: the source-side terms expected after case-sensitive, word-boundary-aware matching, protected-span exclusion and longer-overlap precedence. Treat this list as a set unless a particular test explicitly asserts ordering.
- `protected`: exact spans that must survive in the reference, including repeated occurrences. Code spans include their backtick delimiters. Nested fragments inside a code span are not separately annotated unless they also occur outside it.
- `reference`: one acceptable translation; do not require exact equality in semantic evaluation.
- `notes`: case-specific human acceptance criteria and semantic risks.

ASCII/Latin terms must not match inside a longer identifier or word. CJK terms may match as substrings. Matching is case-sensitive by default: `API` is distinct from `Api`. The longest overlapping glossary term wins; a shorter term can still match a separate occurrence. Terms occurring only inside protected code or URLs are not candidates. Case `technical-19` deliberately contains both `agents` and `agent` to test boundaries.

## Offline use

The implementation's offline evaluation entry point should read this same JSON file and report schema/data errors and deterministic failures separately. Checks can compare selected glossary terms, extracted protected spans, preservation counts, and generated request contents without sending text to a model. Keep individual failed IDs in the report so a failure can be reproduced and its annotation reviewed.

The format set includes variables, positional printf placeholders, HTML/XML markup, inline/fenced code, links, repeated protected spans and multiline text. Markdown headings and list layout are human review items unless an implemented validator explicitly supports them; do not silently count them as automatically verified. Preserving HTML tags does not by itself prove correct nesting or safe rendering.

Numbers are deliberately not unconditional exact-string constraints. For example, `1,200` may become `1200`, and `9:30` may be rendered as `九点半`. A human checks equivalent values, units, currency, date/time interpretation and direction of change. Similarly, rearranging `%s` and `%d` in a natural target-language sentence may be valid, but their types, identities and occurrence counts must remain intact.

## Controlled model comparison, when authorized

1. Freeze the dataset revision, model identifier, provider settings, prompt revision and terminology data. Capture the baseline before comparing a change.
2. Use the same source input and availability of context in both variants. Ambiguity cases with context and without context are separate conditions. Do not give only the new variant information the baseline did not receive and attribute all benefit to prompt wording.
3. Use only a configured and authorized provider. This phase does not create credentials, introduce paid services, or imply permission to send private texts externally.
4. Save raw outputs per case and variant. Record input/output tokens when provided, first visible token time, total response time, failures and retries. Missing usage statistics remain missing, not zero. Keep network and provider conditions in the report.
5. Blind and shuffle outputs where practical. Review against the source, context and notes, not merely similarity to the reference. Label mistranslation, omission, unsupported addition, terminology conflict and format damage separately; label severity and provide the offending span. Natural phrasing is a separate judgement.
6. Report error counts by category, not a fabricated universal quality score. For timing, report the sample size and median/tail values; do not infer real API performance from local fixture execution. Repeat selected runs to identify stochastic variation.
7. Fix obvious annotation mistakes transparently and version the dataset. After tuning against these cases, add a separate unseen holdout set before claiming general quality improvement.

Do not silently replace a failed output with a retry when comparing the default single-request path. A rule check that passes is not a calibrated confidence probability. When independent human reviewers disagree, retain the disagreement or adjudication rather than pretending the reference is uniquely correct.

## Current limitations

This compact set is intentionally focused on English/Chinese technical reading. It does not cover all languages, literary styles, legal or medical translation, arbitrary programming languages, nested markup, malformed files, or every placeholder syntax. All examples are authored; representativeness and generalization remain unmeasured. Real Windows interaction, clipboard isolation, cancellation, streaming lifecycle and end-to-end app behavior require their own regression tests and desktop validation.

## Commands shipped with this change

From the repository root (Rust toolchain required):

```sh
cargo test --locked --manifest-path scripts/translation-quality/Cargo.toml
cargo run --locked --manifest-path scripts/translation-quality/Cargo.toml
# Equivalent package scripts: pnpm test:translation / pnpm eval:translation
```

The small harness imports `prompt.rs`, `request.rs`, `terminology.rs` and `protection.rs` directly from production. Its minimal configuration and HTTP-limit stubs allow pure request tests without linking Tauri or GTK; this is not a replacement for the complete Rust application tests. Its lockfile uses the same dependency versions as the application's lockfile at this revision.

## Application scope and behavior

- Existing completion and streaming API paths share the builder. The source text is not rewritten or masked. A technical preservation hint is added when a relevant glossary term or protected span is detected; otherwise the general prompt is used. This is a deterministic hint, not semantic domain classification and not a new user-facing mode switch.
- Existing glossary storage and settings stay unchanged. Matching remains case-sensitive, with word boundaries and longer overlaps taking precedence. Same-source/target entries preserve spelling. This phase does not introduce separate mandatory/preferred modes or a semantic terminology validator.
- Final API results are checked before returning success or persisting TM/history. Streamed chunks are provisional: users may see partial output before a final preservation error. No automatic repair call is made. The existing cancellation and request-identity owners are unchanged.
- The free Google provider is unchanged in this phase. It does not receive the LLM prompt or this protection gate.
- Context fingerprint version is increased to 3 so old cached API results do not bypass the new pipeline. Old TM rows are retained, not deleted. Existing explicit CSV import remains a separate trusted-data operation.
- The guard catches supported literal loss/change and tag-order changes, not all Markdown structure, equivalent numeric values, semantics, or malicious output. Recognized code is preserved exactly, including its delimiters; translated comments inside such code would be rejected by design.
- Rollback is the isolated implementation commit's `git revert`; no data migration or settings rewrite is needed. Reverting restores the former context fingerprint and prompt behavior. No main merge, package release or service restart is part of this deliverable.
