# GCP billing kill-switch

A Cloud Function that disables billing on the AINPI GCP project
(`thematic-fort-453901-t7`) when the `$10/month` budget alert hits 100%.

Trigger: Pub/Sub topic `billing-alerts`, populated by the budget
`6d1efd94-3b35-4aeb-af19-bb38f3bbb03f` on billing account
`01B58B-9C267D-ECC805`.

## Why

Budget alerts are notification-only. Without this function, a runaway
process (compromised key, infinite-loop script, accidental BigQuery scan
on a huge table) can blow through $10 → $100 → $1000 before anyone reads
the email. This function disables billing within ~1 minute of the budget
hitting 100%, which stops all paid GCP services for the project.

## Architecture

```text
Budget alert (cost >= 100% of $10)
    │ publishes JSON {costAmount, budgetAmount, ...}
    ▼
Pub/Sub topic: projects/thematic-fort-453901-t7/topics/billing-alerts
    │ event delivery
    ▼
Cloud Function: disable-billing-on-budget
    │ reads payload
    │ if costAmount >= budgetAmount:
    │     cloudbilling.projects.updateBillingInfo({billingAccountName: ""})
    ▼
Project billing disabled → all paid services stop
```

## One-time setup

Already-done parts:

- Enabled APIs: `cloudfunctions`, `cloudbuild`, `pubsub`, `cloudbilling`, `serviceusage`, `run`
- Created topic `billing-alerts`
- Created service account `kill-billing-sa@thematic-fort-453901-t7.iam.gserviceaccount.com`

**Run-yourself parts** (require billing-account-level IAM the agent can't grant):

```bash
# 1. Grant the kill-switch SA billing.projectManager on the billing account
#    (this is the only way to disable billing for a project)
gcloud billing accounts add-iam-policy-binding 01B58B-9C267D-ECC805 \
  --member="serviceAccount:kill-billing-sa@thematic-fort-453901-t7.iam.gserviceaccount.com" \
  --role="roles/billing.projectManager"

# 2. Update the budget to publish to the Pub/Sub topic
gcloud billing budgets update 6d1efd94-3b35-4aeb-af19-bb38f3bbb03f \
  --billing-account=01B58B-9C267D-ECC805 \
  --pubsub-topic=projects/thematic-fort-453901-t7/topics/billing-alerts
```

## Deploy

```bash
cd infrastructure/kill-billing-function
gcloud functions deploy disable-billing-on-budget \
  --gen2 \
  --runtime=python311 \
  --region=us-central1 \
  --source=. \
  --entry-point=disable_billing \
  --trigger-topic=billing-alerts \
  --service-account=kill-billing-sa@thematic-fort-453901-t7.iam.gserviceaccount.com \
  --set-env-vars=PROJECT_ID=thematic-fort-453901-t7 \
  --no-allow-unauthenticated
```

## Recovery

If the kill-switch fires, you'll get the budget alert email AND every
GCP service for the project stops on the next billing cycle. To resume:

```bash
gcloud billing projects link thematic-fort-453901-t7 \
  --billing-account=01B58B-9C267D-ECC805
```

Then investigate why the budget was exceeded (`gcloud logging read`,
INFORMATION_SCHEMA.JOBS_BY_PROJECT, etc.) before resuming.

## Testing without firing

To verify the function deploys + the Pub/Sub trigger is wired without
actually disabling billing, manually publish a test payload with cost
BELOW budget:

```bash
gcloud pubsub topics publish billing-alerts \
  --message='{"costAmount":0.50,"budgetAmount":10.00,"alertThresholdExceeded":0.5,"currencyCode":"USD"}'
```

Check Cloud Function logs:

```bash
gcloud functions logs read disable-billing-on-budget --gen2 --region=us-central1 --limit=10
```

Expected log: `event: cost=$0.50 budget=$10.00` and `under budget; no action`.

**Do NOT test with cost >= budget unless you actually want billing
disabled.** If you do, recovery is the `gcloud billing projects link`
command above.
