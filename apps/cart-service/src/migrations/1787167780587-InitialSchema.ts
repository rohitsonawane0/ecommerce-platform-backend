import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1787167780587 implements MigrationInterface {
    name = 'InitialSchema1787167780587'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() below needs this; synchronize used to create it
        // implicitly, migrations must ask for it explicitly.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "cart_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" uuid NOT NULL, "productName" character varying NOT NULL, "productPrice" numeric(10,2) NOT NULL, "quantity" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "cartId" uuid, CONSTRAINT "CHK_97e46061626057a99234ff6b8e" CHECK ("quantity" >= 1), CONSTRAINT "PK_6fccf5ec03c172d27a28a82928b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_72679d98b31c737937b8932ebe" ON "cart_items" ("productId") `);
        await queryRunner.query(`CREATE TABLE "carts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_69828a178f152f157dcf2f70a89" UNIQUE ("userId"), CONSTRAINT "PK_b5f695a59f5ebb50af3c8160816" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_69828a178f152f157dcf2f70a8" ON "carts" ("userId") `);
        await queryRunner.query(`ALTER TABLE "cart_items" ADD CONSTRAINT "FK_edd714311619a5ad09525045838" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cart_items" DROP CONSTRAINT "FK_edd714311619a5ad09525045838"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_69828a178f152f157dcf2f70a8"`);
        await queryRunner.query(`DROP TABLE "carts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_72679d98b31c737937b8932ebe"`);
        await queryRunner.query(`DROP TABLE "cart_items"`);
    }

}
