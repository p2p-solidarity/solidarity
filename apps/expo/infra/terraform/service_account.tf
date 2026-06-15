resource "google_service_account" "play_publisher" {
  project = data.google_project.play.project_id

  account_id   = var.sa_account_id
  display_name = "Solidarity Play Console Publisher"
  description  = "Uploads Solidarity AABs to Google Play via Android Publisher API. Lives in a shared GCP project to avoid Google's per-billing-account project quota. Key generated out-of-band, never stored in tfstate."
}
