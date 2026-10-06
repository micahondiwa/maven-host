CREATE TABLE hosting_plan (
 id integer PRIMARY KEY,
 slug varchar(100) NOT NULL UNIQUE,
 name varchar(150) NOT NULL,
 plan_type varchar(30) NOT NULL,
 verification_status varchar(30) NOT NULL,
 document jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE hosting_plan_price (
 id integer PRIMARY KEY,
 plan_id integer NOT NULL REFERENCES hosting_plan(id) ON DELETE CASCADE,
 billing_cycle varchar(30) NOT NULL,
 currency char(3) NOT NULL,
 price numeric(12,2) NOT NULL,
 regular_price numeric(12,2) NOT NULL,
 sale_price numeric(12,2),
 setup_fee numeric(12,2) NOT NULL,
 UNIQUE(plan_id,billing_cycle,currency)
);
