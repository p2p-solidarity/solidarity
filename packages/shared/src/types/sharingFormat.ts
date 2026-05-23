/**
 * Sharing format & level — mirrors solidarity/Models/SharingFormat.swift
 * and BusinessCard.swift (BusinessCardField / SharingLevel / FieldVerificationStatus /
 * NameType).
 *
 * Wire format: Swift uses lowercase rawValues for SharingFormat, lowercase
 * for SharingLevel + BusinessCardField, snake_case for
 * FieldVerificationStatus ("self_attested" / "verified_by_source").
 */
import { z } from 'zod';

export const sharingFormatSchema = z.enum(['plaintext', 'zkProof', 'didSigned']);
export type SharingFormat = z.infer<typeof sharingFormatSchema>;

export const sharingLevelSchema = z.enum(['public', 'professional', 'personal']);
export type SharingLevel = z.infer<typeof sharingLevelSchema>;

export const businessCardFieldSchema = z.enum([
  'name',
  'title',
  'company',
  'email',
  'phone',
  'profileImage',
  'socialNetworks',
  'skills',
]);
export type BusinessCardField = z.infer<typeof businessCardFieldSchema>;

export const fieldVerificationStatusSchema = z.enum([
  'unverified',
  'self_attested',
  'verified_by_source',
]);
export type FieldVerificationStatus = z.infer<typeof fieldVerificationStatusSchema>;

export const nameTypeSchema = z.enum(['display_name', 'verified_legal_name']);
export type NameType = z.infer<typeof nameTypeSchema>;
