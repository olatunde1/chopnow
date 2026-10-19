-- Runs once when the docker-compose Postgres volume is first created.
CREATE DATABASE chopnow_test OWNER chopnow;
-- Browser end-to-end and load tests (tests/e2e, tests/load) reset this one on every run.
CREATE DATABASE chopnow_e2e OWNER chopnow;
