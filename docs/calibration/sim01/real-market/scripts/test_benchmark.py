"""Small analytical fixtures; no Parquet download or Node dependencies required."""

import os
import tempfile
import unittest

os.environ.setdefault('SIM01_WORK_DIR', tempfile.gettempdir())
from analyze import Bag, Dataset, dist, moves
from reproduce import compare_subset


class BenchmarkTests(unittest.TestCase):
    def test_sizes_sides_and_denominators(self):
        bag = Bag()
        bag.add([(0.1, 110, .2, 1, 'buy'), (0.2, 121, .3, 2, 'buy'),
                 (2.1, 100, .2, 3, 'sell'), (2.2, 90, .1, 4, 'sell'),
                 (4.1, 99, .2, 5, 'buy')], 0, 5, 100)
        result = bag.result()
        self.assertEqual(result['direction_changes_per_100_trades'], 40)
        self.assertEqual(result['buy_quote_sol_per_exposure_second'], 1.6)
        self.assertEqual(result['sell_quote_sol_per_exposure_second'], 1.4)
        self.assertEqual(result['trades_per_active_episode_second_bin'], 5 / 3)
        self.assertEqual(result['transaction_quote_sol']['p50'], 3)
        self.assertEqual(result['buy_run_length_trades']['p50'], 1.5)
        self.assertEqual(result['sell_run_length_trades']['p50'], 2)
        self.assertEqual(result['empty_bin_share'], 2 / 5)
        self.assertAlmostEqual(result['drawdown_trade_pct']['p50'], (1 - 90 / 121) * 100)

    def test_zero_exposure_and_silence_are_not_zero_buy_share(self):
        bag = Bag()
        bag.add([], 0, 5, 100)
        result = bag.result()
        self.assertIsNone(result['buy_count_share'])
        self.assertIsNone(result['direction_changes_per_100_trades'])
        self.assertIsNone(result['trades_per_active_episode_second_bin'])
        self.assertEqual(result['empty_bin_share'], 1)
        point = Bag()
        point.add([(1, 110, .5, 2, 'buy')], 1, 1, 100)
        self.assertIsNone(point.result()['buy_quote_sol_per_exposure_second'])

    def test_first80_keeps_retreat_and_entry_trade_is_not_double_counted(self):
        data = Dataset('fixture')
        data.add('token', [(1, 100, .81, 1, 'buy'), (2, 60, .6, 2, 'sell'),
                           (4, 120, .91, 3, 'buy')], 10, None)
        result = data.result()
        self.assertEqual(result['returned_below80'], 1)
        self.assertEqual(result['metrics']['from80']['trades'], 2)
        self.assertEqual(result['metrics']['from80']['duration_sec'], 9)
        self.assertEqual(result['metrics']['from80']['drawdown_trade_pct']['p50'], 40)
        self.assertEqual(result['first80_to_first90_sec']['p50'], 3)
        self.assertEqual(result['metrics']['80_90']['trades'], 1)  # Exit SELL belongs to old band.

    def test_known_runs_and_weighted_quantiles(self):
        from collections import Counter
        dd, impulse, correction, changes, _ = moves([110, 88, 110], 100)
        self.assertAlmostEqual(dd, 20)
        self.assertAlmostEqual(impulse[1], 25)
        self.assertAlmostEqual(correction[0], 20)
        self.assertEqual(changes, 2)
        self.assertEqual(dist(Counter({0: 9, 10: 1}))['p90'], dist([0] * 9 + [10])['p90'])

    def test_reference_check_does_not_tolerate_missing_counts(self):
        compare_subset({'value': 1.0}, {'value': 1.0 + 1e-12, 'new_metric': 3})
        with self.assertRaises(AssertionError):
            compare_subset({'trades': 10}, {'trades': 11})
        with self.assertRaises(AssertionError):
            compare_subset({'trades': 10}, {})


if __name__ == '__main__':
    unittest.main()
