import dynamic from 'next/dynamic';

const BotWorkspace = dynamic(() => import('@/components/bot/BotWorkspace'));

export default function BotPage() {
  return <BotWorkspace />;
}
