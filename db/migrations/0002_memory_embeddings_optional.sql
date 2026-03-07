-- Optional semantic recall support.
-- Apply this only when typed memory lookup is no longer enough and you want
-- embedding-based recall inside Postgres.

create extension if not exists vector;

alter table memory_items
  add column embedding vector(1536);

create index memory_items_embedding_idx
  on memory_items
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
