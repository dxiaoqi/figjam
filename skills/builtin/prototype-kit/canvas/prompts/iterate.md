Iterate on the prototype wall.

1. `get_threads` and `query_blocks { type: "prototype-kit.feedback" }`. Turn new comments into feedback stickies
   (variant, verdict, author) and resolve their threads.
2. Apply `prototype-kit.feedback-matrix`.
3. For each variant with change requests: `update_snippet` with the smallest change that answers them, bump
   `round`, reply on the feedback. Mark variants with only `drop` verdicts as dropped.
4. Commit and summarize what changed per variant.
