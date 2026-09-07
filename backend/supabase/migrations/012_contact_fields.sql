-- Migration 012: Campos de contato (nome/email) em lead_profiles
-- Captura universal de formulários de contato via tracker.js
-- Colunas nullable: nem todo lead preenche, e o quiz continua funcionando sem elas.

ALTER TABLE lead_profiles ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE lead_profiles ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- Índice para busca por email (dedupe, exportação, CRM sync futuro)
CREATE INDEX IF NOT EXISTS idx_lead_profiles_contact_email
  ON lead_profiles (contact_email)
  WHERE contact_email IS NOT NULL;