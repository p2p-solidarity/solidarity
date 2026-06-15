output "project_id" {
  value       = data.google_project.play.project_id
  description = "Shared GCP project hosting the Solidarity SA."
}

output "service_account_email" {
  value       = google_service_account.play_publisher.email
  description = "Invite this email in Play Console -> Users and permissions."
}

output "next_steps" {
  description = "Manual steps that cannot be automated."
  value       = <<-EOT

    ============================================================
    Solidarity Play publisher SA is ready inside the shared
    project ${data.google_project.play.project_id}.
    Keys are generated out-of-band (never in tfstate):
      bun run gcp:bootstrap   # writes ./secrets/play-sa-key.json
    ============================================================

    SA: ${google_service_account.play_publisher.email}

    1) Key -> ./secrets/play-sa-key.json (bootstrap does this).
       Manual equivalent:
         gcloud iam service-accounts keys create ./secrets/play-sa-key.json \
           --iam-account=${google_service_account.play_publisher.email} \
           --project=${data.google_project.play.project_id}

    2) Play Console (https://play.google.com/console)
       -> Users and permissions -> Invite new users
         Email:      ${google_service_account.play_publisher.email}
         Permission: Release manager
       Play Console treats this SA as a separate publisher
       identity from ani; only the underlying GCP project is
       shared.

    3) Upload the FIRST AAB by hand via the Play Console UI.
       Google requires a human for the initial release; the SA
       takes over uploads after that.

    4) From then on, release via:
         bun run build:android:local && bun run submit:android

  EOT
}
