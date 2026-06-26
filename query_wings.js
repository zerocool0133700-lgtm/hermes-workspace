// Query to find all palace-wing documents under S/memory
import { getSql, closeSql } from '/home/ellie/ellie-proving-ground/packages/server/src/db/client.ts';

const sql = getSql();
const wings = await sql`
  SELECT d.id, (d.data->>'name') as wing_name, (d.data->>'wing_type') as wing_type
  FROM contract_builder.data_contract_documents d
  JOIN contract_builder.data_contracts c ON c.id = d.contract_id
  WHERE c.name = 'palace-wing' AND d.scope_id = (
    SELECT id FROM contract_builder.knowledge_scopes WHERE scope_path = 'S/memory'
  )
  ORDER BY d.created_at ASC
`;

wings.forEach(w => {
  console.log(`${w.wing_name}: ${w.id}`);
});

await closeSql();
