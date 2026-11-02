import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

void main() {
  testWidgets('Demo mode opens on Today with the bottom navigation', (tester) async {
    await pumpDemoApp(tester);
    expect(find.text('Today'), findsWidgets);
    expect(find.text('Leads'), findsWidgets);
    expect(find.text('Calls to make'), findsOneWidget);
  });
}
