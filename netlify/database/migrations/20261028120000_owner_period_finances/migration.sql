CREATE TABLE relation_finances (
  relation_id integer PRIMARY KEY REFERENCES unit_person_relations(id) ON DELETE RESTRICT,
  quarterly_call numeric(10,2), balance numeric(10,2), updated_at timestamp NOT NULL DEFAULT now()
);
-- Reprise uniquement des correspondances non ambiguës ; les valeurs historiques
-- de building_members sont conservées et consultables par le syndic.
INSERT INTO relation_finances (relation_id, quarterly_call, balance)
SELECT r.id, m.quarterly_call, m.balance
FROM building_members m JOIN building_people p ON p.user_id=m.user_id AND p.building_id=m.building_id
JOIN unit_person_relations r ON r.person_id=p.id AND r.relation_type='owner' AND r.end_date IS NULL
JOIN building_units u ON u.id=r.unit_id AND u.building_id=m.building_id AND u.label=m.unit_label
WHERE m.ended_at IS NULL AND
 (SELECT count(*) FROM unit_person_relations active WHERE active.person_id=p.id AND active.relation_type='owner' AND active.end_date IS NULL)=1;
