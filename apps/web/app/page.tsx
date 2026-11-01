import Link from 'next/link';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

/** Placeholder home. frontend-app replaces this with the app shell and dashboard in Wave 1. */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <div>
            <CardTitle>Vistar</CardTitle>
            <CardDescription>Foundation is running. The app shell arrives in Wave 1.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="primary" asChild>
            <Link href="/kit">Open UI kit</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
