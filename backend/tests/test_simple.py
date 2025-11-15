"""Simple test to verify pytest is working."""

import pytest
from unittest.mock import patch, MagicMock


def test_addition():
    """Test basic arithmetic."""
    assert 1 + 1 == 2


def test_string_operations():
    """Test string operations."""
    test_string = "Hello World"
    assert test_string.lower() == "hello world"
    assert test_string.upper() == "HELLO WORLD"
    assert len(test_string) == 11


def test_list_operations():
    """Test list operations."""
    test_list = [1, 2, 3, 4, 5]
    assert len(test_list) == 5
    assert sum(test_list) == 15
    assert max(test_list) == 5
    assert min(test_list) == 1


class TestMathOperations:
    """Test class for math operations."""

    def test_multiplication(self):
        """Test multiplication."""
        assert 3 * 4 == 12

    def test_division(self):
        """Test division."""
        assert 10 / 2 == 5

    def test_division_by_zero(self):
        """Test division by zero raises error."""
        with pytest.raises(ZeroDivisionError):
            _ = 10 / 0


@pytest.mark.parametrize("input_value,expected", [
    (1, 2),
    (2, 4),
    (3, 6),
    (4, 8),
])
def test_double_value(input_value, expected):
    """Test doubling values with parametrize."""
    assert input_value * 2 == expected


def test_mock_example():
    """Example of using mock in tests."""
    mock_func = MagicMock(return_value=42)
    result = mock_func()
    assert result == 42
    mock_func.assert_called_once()