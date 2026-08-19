import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1787167782862 implements MigrationInterface {
    name = 'InitialSchema1787167782862'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() below needs this; synchronize used to create it
        // implicitly, migrations must ask for it explicitly.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "addresses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "label" character varying(50), "fullName" character varying(120) NOT NULL, "phone" character varying(30) NOT NULL, "line1" character varying(200) NOT NULL, "line2" character varying(200), "city" character varying(100) NOT NULL, "state" character varying(100) NOT NULL, "postalCode" character varying(20) NOT NULL, "country" character(2) NOT NULL, "isDefaultShipping" boolean NOT NULL DEFAULT false, "isDefaultBilling" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_745d8f43d3af10ab8247465e450" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_95c93a584de49f0b0e13f75363" ON "addresses" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_bb3bf6f60f9484b5e499284cec" ON "addresses" ("userId", "deletedAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_bb3bf6f60f9484b5e499284cec"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_95c93a584de49f0b0e13f75363"`);
        await queryRunner.query(`DROP TABLE "addresses"`);
    }

}
