const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const tables = {
  tasks: process.env.SUPABASE_TABLE_TASKS || 'SeriesList',
  freelancers: process.env.SUPABASE_TABLE_FREELANCERS || 'Freelancer',
  deadlines: process.env.SUPABASE_TABLE_DEADLINES || 'SeriesList',
  companyDeadlines: process.env.SUPABASE_TABLE_COMPANY_DEADLINES || 'Companies',
  qrcodes: process.env.SUPABASE_TABLE_QR || 'Freelancer',
  errors: process.env.SUPABASE_TABLE_ERRORS || 'Error'
};

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && serviceRoleKey);
}

export async function selectRows(collection) {
  if (!isSupabaseConfigured()) return [];

  const table = tables[collection];
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?select=*`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase query failed for ${table}: ${message}`);
  }

  return response.json();
}
