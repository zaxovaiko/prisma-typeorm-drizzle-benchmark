CREATE DATABASE bench_prisma;
CREATE DATABASE bench_typeorm;
\c bench_prisma
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
\c bench_typeorm
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
