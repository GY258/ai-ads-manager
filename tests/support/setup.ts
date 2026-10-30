// Tests never touch the demo project or paid APIs: in-memory Postgres, local storage, mock adapters.
process.env.AI_MODE = "mock";
process.env.DB_DRIVER = process.env.TEST_DB_DRIVER ?? "pglite";
process.env.STORAGE_DRIVER = process.env.TEST_STORAGE_DRIVER ?? "local";
process.env.LOCAL_STORAGE_DIR ??= `runs/test-storage/${process.pid}`;
delete process.env.PGLITE_DIR;
