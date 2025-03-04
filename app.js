const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('center.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err);
    } else {
        console.log('Тетрадка готова!');
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        groupId INTEGER,
        FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_teachers (
        groupId INTEGER,
        teacherId INTEGER,
        PRIMARY KEY (groupId, teacherId),
        FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (teacherId) REFERENCES teachers(id) ON DELETE CASCADE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        studentId INTEGER,
        date TEXT NOT NULL,
        present INTEGER DEFAULT 0,
        FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE
    )`);

    db.get("SELECT COUNT(*) as count FROM teachers WHERE username = 'admin'", (err, row) => {
        if (err) {
            console.error('Ошибка проверки админа:', err);
        } else if (row.count === 0) {
            db.run("INSERT INTO teachers (username, password) VALUES (?, ?)", ["admin", "admin123"], (err) => {
                if (err) console.error('Ошибка добавления админа:', err);
            });
        }
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM teachers WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) {
            console.error('Ошибка при входе:', err);
            res.status(500).send(err);
        } else if (row) {
            res.json({ id: row.id, username: row.username });
        } else {
            res.status(401).send('Неверный логин или пароль');
        }
    });
});

app.post('/add-teacher', (req, res) => {
    const { username, password } = req.body;
    db.run('INSERT INTO teachers (username, password) VALUES (?, ?)', [username, password], function(err) {
        if (err) {
            console.error('Ошибка добавления учителя:', err);
            res.status(500).json({ error: err.message });
        } else {
            res.json({ id: this.lastID, username });
        }
    });
});

app.delete('/delete-teacher/:id', (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM group_teachers WHERE teacherId = ?', [id], (err) => {
        if (err) {
            console.error('Ошибка удаления связей учителя с группами:', err);
            res.status(500).send(err);
        }
        db.run('DELETE FROM students WHERE groupId IN (SELECT id FROM groups WHERE id IN (SELECT groupId FROM group_teachers WHERE teacherId = ?))', [id], (err) => {
            if (err) {
                console.error('Ошибка удаления студентов:', err);
                res.status(500).send(err);
            }
            db.run('DELETE FROM groups WHERE id NOT IN (SELECT groupId FROM group_teachers WHERE groupId IS NOT NULL)', (err) => {
                if (err) {
                    console.error('Ошибка очистки пустых групп:', err);
                    res.status(500).send(err);
                }
                db.run('DELETE FROM teachers WHERE id = ?', [id], (err) => {
                    if (err) {
                        console.error('Ошибка удаления учителя:', err);
                        res.status(500).send(err);
                    } else {
                        res.json({ message: 'Учитель удалён' });
                    }
                });
            });
        });
    });
});

app.get('/groups', (req, res) => {
    const teacherId = req.query.teacherId;
    if (teacherId === 'admin') {
        db.all(`
            SELECT g.*, GROUP_CONCAT(t.id) AS teacherIds, GROUP_CONCAT(t.username) AS teacherNames 
            FROM groups g 
            LEFT JOIN group_teachers gt ON g.id = gt.groupId 
            LEFT JOIN teachers t ON gt.teacherId = t.id 
            GROUP BY g.id
        `, [], (err, rows) => {
            if (err) {
                console.error('Ошибка получения групп:', err);
                res.status(500).send(err);
            } else {
                const groups = rows.map(row => ({
                    ...row,
                    teacherIds: row.teacherIds ? row.teacherIds.split(',').map(id => parseInt(id, 10)) : [],
                    teacherNames: row.teacherNames ? row.teacherNames.split(',') : []
                }));
                res.json(groups);
            }
        });
    } else {
        db.all(`
            SELECT g.*, GROUP_CONCAT(t.id) AS teacherIds, GROUP_CONCAT(t.username) AS teacherNames 
            FROM groups g 
            LEFT JOIN group_teachers gt ON g.id = gt.groupId 
            LEFT JOIN teachers t ON gt.teacherId = t.id 
            WHERE gt.teacherId = ? 
            GROUP BY g.id
        `, [teacherId], (err, rows) => {
            if (err) {
                console.error('Ошибка получения групп для учителя:', err);
                res.status(500).send(err);
            } else {
                const groups = rows.map(row => ({
                    ...row,
                    teacherIds: row.teacherIds ? row.teacherIds.split(',').map(id => parseInt(id, 10)) : [],
                    teacherNames: row.teacherNames ? row.teacherNames.split(',') : []
                }));
                res.json(groups);
            }
        });
    }
});

app.post('/add-group', (req, res) => {
    const { name, teacherId } = req.body;
    db.run('INSERT INTO groups (name) VALUES (?)', [name], function(err) {
        if (err) {
            console.error('Ошибка добавления группы:', err);
            res.status(500).json({ error: err.message });
        } else {
            const groupId = this.lastID;
            if (teacherId) {
                const teacherIds = Array.isArray(teacherId) ? teacherId : [teacherId].filter(id => id);
                const placeholders = teacherIds.map(() => '(?, ?)').join(',');
                const values = [];
                teacherIds.forEach(tid => {
                    values.push(groupId, tid);
                });
                db.run(`INSERT INTO group_teachers (groupId, teacherId) VALUES ${placeholders}`, values, (err) => {
                    if (err) {
                        console.error('Ошибка привязки учителей к группе:', err);
                        res.status(500).json({ error: err.message });
                    } else {
                        res.json({ id: groupId, name, teacherIds, teacherNames: teacherIds.map(id => getTeacherName(id)) });
                    }
                });
            } else {
                res.json({ id: groupId, name, teacherIds: [], teacherNames: [] });
            }
        }
    });
});

function getTeacherName(teacherId) {
    return db.get('SELECT username FROM teachers WHERE id = ?', [teacherId], (err, row) => {
        if (err) console.error('Ошибка получения имени учителя:', err);
        return row ? row.username : '';
    });
}

app.put('/edit-group/:id', (req, res) => {
    const { name, teacherId } = req.body;
    const id = req.params.id;
    db.get('SELECT * FROM groups WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('Ошибка проверки группы:', err);
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        db.run('UPDATE groups SET name = ? WHERE id = ?', [name || row.name, id], (err) => {
            if (err) {
                console.error('Ошибка обновления названия группы:', err);
                return res.status(500).json({ error: err.message });
            }
            db.run('DELETE FROM group_teachers WHERE groupId = ?', [id], (err) => {
                if (err) {
                    console.error('Ошибка удаления старых связей учителей:', err);
                    return res.status(500).json({ error: err.message });
                }
                const teacherIds = Array.isArray(teacherId) ? teacherId : [teacherId].filter(id => id);
                if (teacherIds.length > 0) {
                    const placeholders = teacherIds.map(() => '(?, ?)').join(',');
                    const values = [];
                    teacherIds.forEach(tid => {
                        values.push(id, tid);
                    });
                    db.run(`INSERT INTO group_teachers (groupId, teacherId) VALUES ${placeholders}`, values, (err) => {
                        if (err) {
                            console.error('Ошибка добавления новых связей учителей:', err);
                            return res.status(500).json({ error: err.message });
                        }
                        db.get('SELECT * FROM groups WHERE id = ?', [id], (err, updatedRow) => {
                            if (err) {
                                console.error('Ошибка получения обновленной группы:', err);
                                return res.status(500).json({ error: err.message });
                            }
                            db.all('SELECT t.id, t.username FROM group_teachers gt JOIN teachers t ON gt.teacherId = t.id WHERE gt.groupId = ?', [id], (err, teacherRows) => {
                                if (err) {
                                    console.error('Ошибка получения учителей группы:', err);
                                    return res.status(500).json({ error: err.message });
                                }
                                const teacherIds = teacherRows.map(t => t.id);
                                const teacherNames = teacherRows.map(t => t.username);
                                res.json({ id: updatedRow.id, name: updatedRow.name, teacherIds, teacherNames });
                            });
                        });
                    });
                } else {
                    db.get('SELECT * FROM groups WHERE id = ?', [id], (err, updatedRow) => {
                        if (err) {
                            console.error('Ошибка получения обновленной группы:', err);
                            return res.status(500).json({ error: err.message });
                        }
                        res.json({ id: updatedRow.id, name: updatedRow.name, teacherIds: [], teacherNames: [] });
                    });
                }
            });
        });
    });
});

app.delete('/delete-group/:id', (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM students WHERE groupId = ?', [id], (err) => {
        if (err) {
            console.error('Ошибка удаления студентов:', err);
            res.status(500).send(err);
        }
        db.run('DELETE FROM group_teachers WHERE groupId = ?', [id], (err) => {
            if (err) {
                console.error('Ошибка удаления связей группы с учителями:', err);
                res.status(500).send(err);
            }
            db.run('DELETE FROM groups WHERE id = ?', [id], (err) => {
                if (err) {
                    console.error('Ошибка удаления группы:', err);
                    res.status(500).send(err);
                } else {
                    res.json({ message: 'Группа удалена' });
                }
            });
        });
    });
});

app.post('/add-teacher-to-group', (req, res) => {
    const { groupId, teacherId } = req.body;
    if (!groupId || !teacherId) {
        return res.status(400).json({ error: 'groupId и teacherId обязательны' });
    }
    db.get('SELECT * FROM groups WHERE id = ?', [groupId], (err, group) => {
        if (err) {
            console.error('Ошибка проверки группы:', err);
            return res.status(500).json({ error: err.message });
        }
        if (!group) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        db.get('SELECT * FROM teachers WHERE id = ?', [teacherId], (err, teacher) => {
            if (err) {
                console.error('Ошибка проверки учителя:', err);
                return res.status(500).json({ error: err.message });
            }
            if (!teacher) {
                return res.status(404).json({ error: 'Учитель не найден' });
            }
            db.run('INSERT OR IGNORE INTO group_teachers (groupId, teacherId) VALUES (?, ?)', [groupId, teacherId], (err) => {
                if (err) {
                    console.error('Ошибка добавления учителя в группу:', err);
                    return res.status(500).json({ error: err.message });
                }
                db.all('SELECT t.id, t.username FROM group_teachers gt JOIN teachers t ON gt.teacherId = t.id WHERE gt.groupId = ?', [groupId], (err, teacherRows) => {
                    if (err) {
                        console.error('Ошибка получения учителей группы:', err);
                        return res.status(500).json({ error: err.message });
                    }
                    const teacherIds = teacherRows.map(t => t.id);
                    const teacherNames = teacherRows.map(t => t.username);
                    res.json({ groupId, teacherIds, teacherNames });
                });
            });
        });
    });
});

app.delete('/remove-teacher-from-group', (req, res) => {
    const { groupId, teacherId } = req.body;
    if (!groupId || !teacherId) {
        return res.status(400).json({ error: 'groupId и teacherId обязательны' });
    }
    db.get('SELECT * FROM groups WHERE id = ?', [groupId], (err, group) => {
        if (err) {
            console.error('Ошибка проверки группы:', err);
            return res.status(500).json({ error: err.message });
        }
        if (!group) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        db.get('SELECT * FROM teachers WHERE id = ?', [teacherId], (err, teacher) => {
            if (err) {
                console.error('Ошибка проверки учителя:', err);
                return res.status(500).json({ error: err.message });
            }
            if (!teacher) {
                return res.status(404).json({ error: 'Учитель не найден' });
            }
            db.run('DELETE FROM group_teachers WHERE groupId = ? AND teacherId = ?', [groupId, teacherId], (err) => {
                if (err) {
                    console.error('Ошибка удаления учителя из группы:', err);
                    return res.status(500).json({ error: err.message });
                }
                db.all('SELECT t.id, t.username FROM group_teachers gt JOIN teachers t ON gt.teacherId = t.id WHERE gt.groupId = ?', [groupId], (err, teacherRows) => {
                    if (err) {
                        console.error('Ошибка получения обновленного списка учителей:', err);
                        return res.status(500).json({ error: err.message });
                    }
                    const teacherIds = teacherRows.map(t => t.id);
                    const teacherNames = teacherRows.map(t => t.username);
                    res.json({ groupId, teacherIds, teacherNames });
                });
            });
        });
    });
});

app.get('/teachers', (req, res) => {
    const id = req.query.id;
    if (id) {
        db.get('SELECT id, username FROM teachers WHERE id = ?', [id], (err, row) => {
            if (err) {
                console.error('Ошибка получения учителя:', err);
                res.status(500).send(err);
            } else if (row) {
                res.json([row]);
            } else {
                res.status(404).json({ error: 'Учитель не найден' });
            }
        });
    } else {
        db.all('SELECT id, username FROM teachers', [], (err, rows) => {
            if (err) {
                console.error('Ошибка получения учителей:', err);
                res.status(500).send(err);
            } else {
                res.json(rows);
            }
        });
    }
});

app.get('/students', (req, res) => {
    const groupId = req.query.groupId;
    if (groupId) {
        db.all('SELECT * FROM students WHERE groupId = ?', [groupId], (err, rows) => {
            if (err) {
                console.error('Ошибка получения учеников:', err);
                res.status(500).send(err);
            } else {
                res.json(rows);
            }
        });
    } else {
        db.all('SELECT * FROM students', [], (err, rows) => {
            if (err) {
                console.error('Ошибка получения всех учеников:', err);
                res.status(500).send(err);
            } else {
                res.json(rows);
            }
        });
    }
});

app.post('/add-student', (req, res) => {
    const { name, groupId } = req.body;
    db.run('INSERT INTO students (name, groupId) VALUES (?, ?)', [name, groupId], function(err) {
        if (err) {
            console.error('Ошибка добавления ученика:', err);
            res.status(500).send(err);
        } else {
            res.json({ id: this.lastID, name, groupId });
        }
    });
});

app.put('/edit-student/:id', (req, res) => {
    const { name } = req.body;
    const id = req.params.id;
    db.run('UPDATE students SET name = ? WHERE id = ?', [name, id], function(err) {
        if (err) {
            console.error('Ошибка редактирования ученика:', err);
            res.status(500).send(err);
        } else {
            res.json({ id, name });
        }
    });
});

app.delete('/delete-student/:id', (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM students WHERE id = ?', [id], (err) => {
        if (err) {
            console.error('Ошибка удаления ученика:', err);
            res.status(500).send(err);
        } else {
            res.json({ message: 'Ученик удалён' });
        }
    });
});

app.post('/toggle-present', (req, res) => {
    const { studentId } = req.body;
    const date = new Date().toLocaleDateString();
    db.get('SELECT present FROM attendance WHERE studentId = ? AND date = ?', [studentId, date], (err, row) => {
        if (err) {
            console.error('Ошибка проверки посещаемости:', err);
            res.status(500).send(err);
        } else {
            const newPresent = row ? (row.present ? 0 : 1) : 1;
            if (row) {
                db.run('UPDATE attendance SET present = ? WHERE studentId = ? AND date = ?', [newPresent, studentId, date], (err) => {
                    if (err) {
                        console.error('Ошибка обновления посещаемости:', err);
                        res.status(500).send(err);
                    } else {
                        res.json({ id: studentId, present: newPresent, date });
                    }
                });
            } else {
                db.run('INSERT INTO attendance (studentId, date, present) VALUES (?, ?, ?)', [studentId, date, newPresent], (err) => {
                    if (err) {
                        console.error('Ошибка добавления посещаемости:', err);
                        res.status(500).send(err);
                    } else {
                        res.json({ id: studentId, present: newPresent, date });
                    }
                });
            }
        }
    });
});

app.get('/attendance', (req, res) => {
    const groupId = req.query.groupId;
    const date = req.query.date || new Date().toLocaleDateString();
    db.all(`
        SELECT s.id, s.name, a.present, a.date 
        FROM students s 
        LEFT JOIN attendance a ON s.id = a.studentId AND a.date = ?
        WHERE s.groupId = ?
    `, [date, groupId], (err, rows) => {
        if (err) {
            console.error('Ошибка получения посещаемости:', err);
            res.status(500).send(err);
        } else {
            res.json(rows);
        }
    });
});

app.get('/report', (req, res) => {
    const groupId = req.query.groupId;
    const month = req.query.month; // Формат: "2025-03"
    if (!groupId || !month) {
        return res.status(400).json({ error: 'groupId и month обязательны' });
    }
    const startDate = `${month}-01`; // Начало месяца
    const endDate = new Date().toLocaleDateString('ru-RU'); // Сегодня в формате ДД.ММ.ГГГГ

    db.all(`
        SELECT s.id, s.name, COUNT(a.present) as daysPresent
        FROM students s
        LEFT JOIN attendance a ON s.id = a.studentId AND a.date BETWEEN ? AND ? AND a.present = 1
        WHERE s.groupId = ?
        GROUP BY s.id, s.name
    `, [startDate, endDate, groupId], (err, rows) => {
        if (err) {
            console.error('Ошибка получения отчёта:', err);
            res.status(500).send(err);
        } else {
            res.json(rows);
        }
    });
});

app.listen(port, () => {
    console.log('Сайт работает на http://localhost:3000');
});