# The crawler has moved

The FHIR endpoint liveness crawler (`ainpi-probe`) now lives in its own auditable repository:

→ **<https://github.com/FHIR-IQ/ainpi-probe>**

Separation is deliberate. The methodology commits to the probe being independently auditable — the code that hits external endpoints should not be entangled with the site or the pipeline. Operators who want to whitelist it can inspect that one repo alone.

History for the code that used to live at this path is preserved in the new repo's commit log.
