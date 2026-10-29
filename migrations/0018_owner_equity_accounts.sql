INSERT INTO accounts (code, name, type, normal_side, parent_id, is_postable) VALUES
  ('3110', 'Modal Kevin', 'equity', 'credit', (SELECT id FROM accounts WHERE code = '3100'), 1),
  ('3120', 'Prive Kevin', 'equity', 'debit', (SELECT id FROM accounts WHERE code = '3100'), 1);
