-- PowerSync replicates exactly these tables. A new synced table needs its own `ALTER PUBLICATION powersync ADD TABLE`.
CREATE PUBLICATION powersync FOR TABLE "tasks", "projects", "sections", "labels", "comments", "reads", "settings", "access";
