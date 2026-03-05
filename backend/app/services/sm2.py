from datetime import date, timedelta


def sm2_next(
    ease_factor: float,
    interval: int,
    repetitions: int,
    quality: int,
) -> tuple[float, int, int, date]:
    """
    SM-2 spaced repetition algorithm.
    quality: 0-5 (0-2 = failure, 3-5 = success)
    Returns: (new_ease_factor, new_interval, new_repetitions, next_review_date)
    """
    if quality < 3:
        # Reset on failure
        new_repetitions = 0
        new_interval = 1
    else:
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 6
        else:
            new_interval = round(interval * ease_factor)
        new_repetitions = repetitions + 1

    # Update ease factor
    new_ef = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    new_ef = max(1.3, new_ef)

    next_date = date.today() + timedelta(days=new_interval)
    return new_ef, new_interval, new_repetitions, next_date
