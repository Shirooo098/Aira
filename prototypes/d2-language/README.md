# Aira D2 prototype

Separate development workspace for Aira language understanding experiments.
Aira is the current project name; Tindig is the former name.

Shared application: ../Aira

Start with TypeScript product/alias resolution, command parsing, and editable drafts.
Keep processing independent of React Native, microphone capture, screens, and SQLite.
Use sample catalog data until the real catalog interface is agreed with the team.
Keep model-specific inference behind an adapter.

Folders:
- src: portable processing code
- tests: behavior tests and fixtures
- models: local model files, excluded from Git

This prototype does not complete blocked application tickets.
Integration requires owner review flows, real persistence, and Android offline verification.

Before selecting tooling, align Node, TypeScript, and test-runner versions with the shared app.
TypeScript tooling is installed. The model file is managed locally and excluded from Git.


## Supported order prototype

- Whole-piece quantities: isa/isang through lima/limang, and positive safe integers.
- Exact catalog names and owner-approved aliases.
- Item separators: at, and, or commas.
- Missing quantities, unknown products, and alias collisions require clarification.
- Repeated products are combined by the shared resolver using product IDs.
- Malformed multi-item orders require clarification; no partial draft is returned.
- A complete catalog name containing a conjunction is preserved before splitting.
  Mixed lists containing such names may need clarification; this is a bounded parser.
- Contextual corrections remain a future milestone.
- Unrecognized single requests retain the existing model adapter fallback.
  Those model interpretations are not established as reliable by parser tests.

Commands:
- npm run typecheck
- npm test
- npm run demo -- "Isang Coke maliit at dalawang Lucky Me chicken"

The deterministic parser does not require the model server for supported orders.
The desktop model adapter remains separate from portable processing code.
No sale, payment, or stock record is saved by this prototype.
