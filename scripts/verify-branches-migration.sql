-- Run after applying migration 20260519120000_add_branches

-- 1. Main branch exists
SELECT id, name, slug FROM branches WHERE slug = 'main';

-- 2. No NULL branch_id on scoped tables
SELECT 'categories' AS tbl, COUNT(*) AS nulls FROM categories WHERE branch_id IS NULL
UNION ALL SELECT 'products', COUNT(*) FROM products WHERE branch_id IS NULL
UNION ALL SELECT 'orders', COUNT(*) FROM orders WHERE branch_id IS NULL
UNION ALL SELECT 'addons', COUNT(*) FROM addons WHERE branch_id IS NULL
UNION ALL SELECT 'settings', COUNT(*) FROM settings WHERE branch_id IS NULL;

-- 3. Orders per branch
SELECT b.name, COUNT(o.id) AS order_count
FROM branches b
LEFT JOIN orders o ON o.branch_id = b.id
GROUP BY b.id, b.name;

-- 4. Composite unique indexes present
SELECT indexname FROM pg_indexes
WHERE tablename = 'orders' AND indexname LIKE '%branch%';
