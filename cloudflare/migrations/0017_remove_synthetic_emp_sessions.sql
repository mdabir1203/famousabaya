-- 0017_remove_synthetic_emp_sessions.sql
--
-- One-time cleanup: drop sessions whose emp_id isn't a real factory employee
-- (the factory's real roster IDs follow the `e_bc_<barcode>` stable id
-- pattern set by the local server's xlsx-based roster). These leftover rows
-- are from smoke tests, post-deploy probes, and synthetic test runs that the
-- local server ingested into the cloud (the factory server's /api/event
-- push accepted any emp_id; there was no upstream roster guard).
--
-- Before this cleanup the cloud dashboard's per-employee aggregation
-- pulled these test rows in alongside real data, e.g. e13 / e7 / e3 /
-- test-smoke-emp / TEST_CLOUD_ALIGN* / ALIGN_DEMO_1 / POSTDEPLOY_PROBE
-- etc. appearing in the Daily / Weekly / Monthly / Yearly / Custom
-- reports and in the Live row.
--
-- Defense in depth: report.js + state.js also add
--   AND s.emp_id LIKE 'e_bc_%'
-- to the per-employee aggregations, so even if a stray test row
-- reappears it won't surface in the CEO dashboard.

DELETE FROM sessions
 WHERE emp_id NOT LIKE 'e_bc_%';
