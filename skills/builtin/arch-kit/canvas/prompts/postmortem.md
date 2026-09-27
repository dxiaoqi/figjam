Build a blameless incident review on the board with arch-kit.

1. One `arch-kit.event` sticky per fact from the logs, alerts and chat I give you: `time` (ISO), `phase`
   (trigger / detect / impact / respond / recover / learn) and `actor`. Facts only.
2. Apply `arch-kit.incident-timeline`.
3. Connect events to the modules and interfaces involved; add `arch-kit.risk` stickies for contributing factors and
   `arch-kit.decision` cards (status proposed) for follow-ups.
4. `lint_layout`, commit, and summarize time to detect and time to recover.
