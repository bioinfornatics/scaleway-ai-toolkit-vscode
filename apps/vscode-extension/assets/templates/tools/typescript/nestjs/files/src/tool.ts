import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Controller()
class HealthController {
  @Get("health")
  health() { return { status: "ok" }; }
}
@Module({ controllers: [HealthController] })
class AppModule {}

export async function buildApplication() {
  return NestFactory.create(AppModule);
}
// Manual only: await (await buildApplication()).listen(3000, "127.0.0.1");
