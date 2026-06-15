terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.40"
    }
  }
}

# Uses Application Default Credentials from `gcloud auth application-default login`.
# No project is set on the provider on purpose: every resource pins its own
# `project = google_project.play.project_id` so we can create the project itself
# in this same plan without a chicken-and-egg dependency.
provider "google" {}
