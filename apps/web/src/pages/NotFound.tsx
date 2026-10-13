import { MapPinOff } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';

export default function NotFound() {
  return (
    <div className="container-page py-16">
      <EmptyState
        icon={<MapPinOff className="size-6" aria-hidden />}
        title="This route is off the map"
        body="The page you are looking for does not exist or has moved."
        action={
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
        }
      />
    </div>
  );
}
