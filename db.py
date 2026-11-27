import os
import psycopg2
import psycopg2.extras
import psycopg2.pool

pool = psycopg2.pool.ThreadedConnectionPool(1, 5, os.environ["DATABASE_URL"])

def query(sql, params=None):
    conn = pool.getconn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                return [dict(row) for row in cur.fetchall()] if cur.description else None
    finally:
        pool.putconn(conn)

def insert_many(sql, values, template=None):
    if not values:
        return

    conn = pool.getconn()
    try:
        with conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(cur, sql, values, template=template, page_size=1000)
    finally:
        pool.putconn(conn)
