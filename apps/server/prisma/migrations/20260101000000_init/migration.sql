-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "League" AS ENUM ('BEGINNER', 'AMATEUR', 'PRO', 'HIGHROLLER');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('WELCOME_BONUS', 'FREE_TOP_UP', 'TABLE_BUY_IN', 'TABLE_CASH_OUT', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "HandResult" AS ENUM ('WON', 'LOST', 'FOLDED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nickname" VARCHAR(24) NOT NULL,
    "nicknameKey" VARCHAR(24) NOT NULL,
    "avatarUrl" VARCHAR(512),
    "avatarPreset" VARCHAR(16) NOT NULL DEFAULT 'ЁЯжК',
    "chips" BIGINT NOT NULL DEFAULT 0,
    "totalWon" BIGINT NOT NULL DEFAULT 0,
    "totalLost" BIGINT NOT NULL DEFAULT 0,
    "handsPlayed" INTEGER NOT NULL DEFAULT 0,
    "handsWon" INTEGER NOT NULL DEFAULT 0,
    "welcomeBonusClaimed" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "role" VARCHAR(16) NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "ipHash" VARCHAR(64) NOT NULL,
    "userAgent" VARCHAR(512),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChipTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "reference" VARCHAR(128),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChipTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hand" (
    "id" UUID NOT NULL,
    "tableId" VARCHAR(64) NOT NULL,
    "tableName" VARCHAR(80) NOT NULL,
    "league" "League" NOT NULL,
    "handNumber" INTEGER NOT NULL,
    "board" VARCHAR(32) NOT NULL,
    "pot" BIGINT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandParticipant" (
    "id" UUID NOT NULL,
    "handId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seat" INTEGER NOT NULL,
    "startingStack" BIGINT NOT NULL,
    "endingStack" BIGINT NOT NULL,
    "committed" BIGINT NOT NULL,
    "wonAmount" BIGINT NOT NULL,
    "netAmount" BIGINT NOT NULL,
    "folded" BOOLEAN NOT NULL,
    "holeCards" VARCHAR(16) NOT NULL,
    "bestHand" VARCHAR(64),
    "result" "HandResult" NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "User_nicknameKey_key" ON "User"("nicknameKey");

-- CreateIndex
CREATE INDEX "User_totalWon_idx" ON "User"("totalWon" DESC);

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Device_fingerprint_idx" ON "Device"("fingerprint");

-- CreateIndex
CREATE INDEX "Device_ipHash_firstSeenAt_idx" ON "Device"("ipHash", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_fingerprint_key" ON "Device"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "ChipTransaction_userId_createdAt_idx" ON "ChipTransaction"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Hand_tableId_endedAt_idx" ON "Hand"("tableId", "endedAt" DESC);

-- CreateIndex
CREATE INDEX "Hand_endedAt_idx" ON "Hand"("endedAt");

-- CreateIndex
CREATE INDEX "HandParticipant_handId_idx" ON "HandParticipant"("handId");

-- CreateIndex
CREATE INDEX "HandParticipant_userId_playedAt_idx" ON "HandParticipant"("userId", "playedAt" DESC);

-- CreateIndex
CREATE INDEX "HandParticipant_playedAt_wonAmount_idx" ON "HandParticipant"("playedAt", "wonAmount");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChipTransaction" ADD CONSTRAINT "ChipTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandParticipant" ADD CONSTRAINT "HandParticipant_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandParticipant" ADD CONSTRAINT "HandParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

