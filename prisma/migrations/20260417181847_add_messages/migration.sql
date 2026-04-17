-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_toId_fkey" FOREIGN KEY ("toId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
