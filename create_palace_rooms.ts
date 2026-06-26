#!/usr/bin/env bun
// Create palace-room documents for Sasha's 13 memories
// Usage: bun create_palace_rooms.ts

import { runMigrations } from "/home/ellie/ellie-proving-ground/packages/server/src/db/migrations.ts";
import { loadSeedContracts } from "/home/ellie/ellie-proving-ground/packages/server/src/contract-builder/seed-loader.ts";
import { getSql, closeSql } from "/home/ellie/ellie-proving-ground/packages/server/src/db/client.ts";
import { getContractByName } from "/home/ellie/ellie-proving-ground/packages/server/src/contract-builder/contracts.ts";
import { createDocument } from "/home/ellie/ellie-proving-ground/packages/server/src/contract-builder/documents.ts";

const SASHA_SCOPE_ID = "570ff53b-a0bb-4e45-aadf-f64bc12a4329"; // S
const SASHA_MEMORY_SCOPE_ID = "688e5b87-607d-4376-8aaa-8c1d10f9176b"; // S/memory

const wings = {
  protocols: {
    wing_id: "87c77672-7443-4a09-9816-e6fb5c8a7390",
    scope_id: SASHA_SCOPE_ID,
    name: "Foundational Protocols",
    description:
      "Core SOPs and procedures for Sasha to work effectively — Forest hygiene, skill loading discipline, memory palace structure, and the durable layer separation.",
    memories: [
      "6c8f88a9-2ab9-4b48-b3a1-95d3a05b7c20", // Forest memory module source
      "4a358d0d-3ae2-42b6-a18a-3c7fc707e026", // Skills mandatory context
      "b75a2704-2a63-4d57-96c1-4861d048eb47", // Forest search before answering
      "0e573db5-fb2f-4815-9930-b2ef1dda07d8", // Palace structure overview
    ],
  },
  dave: {
    wing_id: "a242bb13-6458-414a-9e9c-0a958ca54a0c",
    scope_id: SASHA_MEMORY_SCOPE_ID,
    name: "The Partnership",
    description:
      "Who Dave is, what he values, how he works, his constraints, and the relationship that shapes everything. Authored by Sasha as working memory, not inherited from Ellie.",
    memories: [
      "ebffdfed-8a6b-455a-83f9-6dcf629d32f5", // I am Sasha identity
      "d3f89917-44b5-4fc7-8bf1-8929b50d2e5a", // Dave uses voiceapp API key
      "fec2885c-22cc-4d3c-8a61-1f480a6f050c", // Working style
      "2e37c431-96e2-4a24-9502-d3322d56fec5", // Ellie OS + proving ground
      "79a0dad8-bcf5-431f-9d45-6654eb28b763", // Timezone + family
      "53600194-6de0-4186-8de2-c4f720bb0b58", // Dyslexia constraint
    ],
  },
  provingground: {
    wing_id: "b3fcdd6d-137b-4003-b52b-0256d247c048",
    scope_id: SASHA_MEMORY_SCOPE_ID,
    name: "The Workshop Architecture",
    description:
      "Technical and architectural context for the proving-ground codebase — Forest structure, contract patterns, context engines, memory palace, and decisions that shape the proving ground.",
    memories: [
      "a8ee8285-5560-435e-994a-5b33b01f3a96", // Forest hygiene issue
      "1a37ca68-4115-4de2-b5a1-51b07db1955e", // Context engine foundation
      "8d84d7a6-2baa-453a-9858-6242bcf9a73b", // Palace architecture
    ],
  },
};

async function main() {
  console.log("🏛️  Sasha's Memory Palace — Creating Palace Rooms\n");

  await runMigrations();
  await loadSeedContracts();

  const contract = await getContractByName("palace-room");
  if (!contract) throw new Error("palace-room contract not seeded");

  let created = 0;
  let failed = 0;

  for (const [key, wing] of Object.entries(wings)) {
    console.log(`\n📚 Wing: ${wing.name}`);
    console.log(`   Memories: ${wing.memories.length}`);

    const result = await createDocument(contract.id, {
      scope_id: wing.scope_id,
      data: {
        dataContractName: "palace-room",
        name: wing.name,
        description: wing.description,
        wing_document_id: wing.wing_id,
        hall_type: "memory",
        load_priority: "on-demand",
        status: "active",
      },
      created_by: "sasha-palace-init",
      source_type: "hermes-sasha",
      source_id: null,
    });

    if (result.accepted && result.document) {
      console.log(`   ✅ Created room: ${result.document.id}`);
      created++;
    } else {
      console.log(`   ❌ Failed: ${JSON.stringify(result.errors)}`);
      failed++;
    }
  }

  console.log(`\n✨ Summary: ${created} created, ${failed} failed\n`);

  await closeSql();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
