import {snapshot} from '@/lib/db';
import Workspace from './workspace';
export const dynamic='force-dynamic';
export default function Page(){return <Workspace data={JSON.parse(JSON.stringify(snapshot())) as unknown as Parameters<typeof Workspace>[0]['data']}/>}
