#!/bin/sh
# Drops and recreates the separate test database (never the demo one), for TEST_DB_URL runs.
set -e
psql "$TEST_DB_ADMIN_URL" -q -c "drop database if exists ai_ads_test with (force)" -c "create database ai_ads_test"
