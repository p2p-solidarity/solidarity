variable "project_id" {
  type        = string
  description = "Existing GCP project to host the SA. Defaults to the shared aniseekr-android-release project so Solidarity does not consume a slot on the billing account's project quota (5/5 default)."
  default     = "aniseekr-android-release"
}

variable "sa_account_id" {
  type        = string
  description = "SA account_id (the part before @). Must not collide with existing SAs in the shared project."
  default     = "solidarity-publisher"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.sa_account_id))
    error_message = "sa_account_id must be 6-30 chars, lowercase letters/digits/hyphens, starting with a letter."
  }
}
