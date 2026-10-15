import {db} from '@/lib/db';
export const runtime='nodejs';
export async function POST(request:Request){
 try {const b=await request.json();
 if(typeof b.name!=='string'||!b.name.trim()||typeof b.email!=='string'||!/^\S+@\S+\.\S+$/.test(b.email)||typeof b.role!=='string'||!b.role.trim()||!Number.isInteger(Number(b.department_id))) return Response.json({error:'Enter a name, valid email, role, and department.'},{status:400});
 if(!db.prepare('SELECT id FROM departments WHERE id=?').get(Number(b.department_id))) return Response.json({error:'Department does not exist.'},{status:400});
 db.prepare('INSERT INTO employees(name,email,role,department_id,joined) VALUES (?,?,?,?,?)').run(b.name.trim(),b.email.trim().toLowerCase(),b.role.trim(),Number(b.department_id),new Date().toISOString().slice(0,10));
 return Response.json({ok:true},{status:201});
 }catch(e){return Response.json({error:String(e).includes('UNIQUE')?'That email is already registered.':'Unable to add employee.'},{status:400})}
}
