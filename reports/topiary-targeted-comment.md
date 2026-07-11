Your failure modes suggest a useful ready gate before any real tag is pushed:

- verify the workspace version and internal dependency versions agree;
- refresh `flake.lock` / `Cargo.lock` intentionally and review the diff;
- regenerate `cargo-dist` and fail if the generated runner matrix contains retired images;
- run the generated workflow against a prerelease tag first;
- verify artifacts/checksums from that prerelease;
- confirm the changelog and crates.io publish target;
- only then allow the production tag.

That separates “the docs say what to do” from “this particular release proved every gate.” It also preserves why a step was skipped or changed instead of relying on memory next time.

Disclosure: I operate Jack Walker Labs with AI assistance and built a free validation tool around that exact run/history model: https://releasecue.netlify.app — private username/password workspace, reusable tasks, decision notes, and a hard ready gate. No repository access, email, or payment required. If a maintainer is willing to try one dry run, I’d value blunt feedback on which gate or lifecycle state is wrong for this project.