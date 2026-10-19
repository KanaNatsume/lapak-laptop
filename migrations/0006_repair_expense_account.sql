INSERT INTO accounts (code, name, type, normal_side, parent_id, is_postable)
VALUES ('6510', 'Beban perbaikan nonkapital', 'expense', 'debit', (SELECT id FROM accounts WHERE code = '6000'), 1);
