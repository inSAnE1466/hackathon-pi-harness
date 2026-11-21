# Label audit: 50 rows of the held-out test set (about 20-30 minutes)

Why: every label in our data was written by an AI. This audit checks that answer key against human judgement.

1. Open `test_label_audit_50.csv` in Excel / Google Sheets. Do NOT look at any model output.
2. For each row read the prompt, then our labels and our route.
3. Fill **AGREE** if both are right. Fill **DISAGREE** if anything is wrong, then give the correct route and which labels to add (+) or
   remove (-), e.g. `+MENTAL_HEALTH -WORK_INCAPACITY`. Use the label names from column E.
4. Rules of thumb: pets are never personal health; a draft "for my review" is never an autonomous decision; a crime that happened TO
   the customer is not criminal data about a person; the strictest label decides the route
   (identifiers -> cloud_redacted, health/criminal -> local, autonomous decision / discrimination / bulk export / injection -> refused).
5. Put your name in `reviewer`. Ideally two teammates audit the same sheet independently (save as `..._<name>.csv`).
6. Send the file back; then run: `python3 eval/audit.py score data/audit/test_label_audit_50_<name>.csv`

Routes: cloud: may go to the outside AI as typed; cloud_redacted: outside AI, but names/numbers replaced by codes; local: must stay on the company's own AI; refused: must be blocked, a human decides
