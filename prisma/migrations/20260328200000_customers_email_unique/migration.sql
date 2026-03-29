-- CreateIndex (nullable column: multiple NULL emails allowed; duplicate non-null emails rejected)
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");
